from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.shortcuts import redirect, render

from .models import UserProfile


@login_required
def dashboard_view(request):
    """Main dashboard — served only to authenticated users."""
    try:
        profile = request.user.profile
    except UserProfile.DoesNotExist:
        # Auto-create a profile for users who don't have one (e.g. superuser)
        profile = UserProfile.objects.create(
            user=request.user,
            full_name=request.user.get_full_name() or request.user.username,
            role='Admin',
            plant_name='Plant A',
        )

    context = {
        'user': request.user,
        'profile': profile,
        'full_name': profile.full_name,
        'role': profile.role,
        'plant_name': profile.plant_name,
    }
    return render(request, 'dashboard/index.html', context)


def login_view(request):
    """Login page. Redirects to dashboard if already authenticated."""
    if request.user.is_authenticated:
        return redirect('dashboard')

    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            next_url = request.GET.get('next', '/')
            return redirect(next_url)
        else:
            messages.error(request, 'Invalid username or password. Please try again.')

    return render(request, 'dashboard/auth.html', {'form_type': 'login'})


def register_view(request):
    """Registration page. Creates Django User + UserProfile."""
    if request.user.is_authenticated:
        return redirect('dashboard')

    if request.method == 'POST':
        full_name = request.POST.get('full_name', '').strip()
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        password2 = request.POST.get('password2', '')
        role = request.POST.get('role', 'Operator')
        plant_name = request.POST.get('plant_name', 'Plant A').strip()

        # Basic validation
        if not full_name or not username or not password:
            messages.error(request, 'Full name, username, and password are required.')
        elif password != password2:
            messages.error(request, 'Passwords do not match.')
        elif User.objects.filter(username=username).exists():
            messages.error(request, f'Username "{username}" is already taken.')
        else:
            user = User.objects.create_user(username=username, password=password)
            UserProfile.objects.create(
                user=user,
                full_name=full_name,
                role=role,
                plant_name=plant_name or 'Plant A',
            )
            messages.success(request, f'Account created! Welcome, {full_name}. Please sign in.')
            return redirect('login')

    return render(request, 'dashboard/auth.html', {'form_type': 'register'})


def logout_view(request):
    """Logs the user out and redirects to login page."""
    logout(request)
    messages.info(request, 'You have been signed out.')
    return redirect('login')

