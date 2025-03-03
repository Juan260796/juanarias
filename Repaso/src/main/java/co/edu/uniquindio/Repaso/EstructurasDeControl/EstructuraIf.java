package co.edu.uniquindio.Repaso.EstructurasDeControl;

import java.util.Scanner;

public class EstructuraIf {
    public static void main(String[] args) {
        System.out.println("ingrese un numero entero: ");
        Scanner sc= new Scanner(System.in);
        int num1= sc.nextInt();
        int residuo= num1 % 2;
        if(residuo==1) {
            System.out.println("El numero es impar");
        } else{
                System.out.println("El numero es par");
            }


        }




}
