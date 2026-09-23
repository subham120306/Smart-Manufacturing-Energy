from django.contrib.auth.models import User
from django.db import models


class UserProfile(models.Model):
    ROLES = [
        ('Plant Manager', 'Plant Manager'),
        ('Admin', 'Admin'),
        ('Maintenance Engineer', 'Maintenance Engineer'),
        ('Operator', 'Operator'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    full_name = models.CharField(max_length=150)
    role = models.CharField(max_length=50, choices=ROLES, default='Operator')
    plant_name = models.CharField(max_length=200, blank=True, default='Plant A')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'User Profile'
        verbose_name_plural = 'User Profiles'

    def __str__(self):
        return f"{self.full_name} ({self.role}) — {self.user.username}"

